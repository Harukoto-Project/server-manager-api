import { createHash, randomBytes } from "node:crypto";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { ApiModuleContext } from "../types.js";
import { loadAuthState, saveAuthState } from "./store.js";

const SINGLE_USER_ID = "primary-user";
const SINGLE_USER_NAME = "Harukoto";
const RECOVERY_CODE_LENGTH = 16;

const verifyBodySchema = z.object({
	response: z.record(z.unknown()),
});

const recoverBodySchema = z.object({
	code: z.string().min(1),
});

function generateRecoveryCode(): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	return Array.from(randomBytes(RECOVERY_CODE_LENGTH))
		.map((b) => chars[b % chars.length])
		.join("");
}

function hashCode(code: string): string {
	return createHash("sha256").update(code).digest("hex");
}

const authModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { env, audit } = opts.ctx;

	fastify.get("/status", async () => {
		const state = await loadAuthState();
		return {
			registrationEnabled: env.SETUP_MODE && state.registrationEnabled,
			passkeyCount: state.passkeys.length,
			rpId: env.WEBAUTHN_RP_ID,
			expectedOrigin: env.WEBAUTHN_ORIGIN,
		};
	});

	fastify.get("/register/options", async (_request, reply) => {
		if (!env.SETUP_MODE) {
			return reply.code(403).send({ error: "登録エンドポイントは無効です。SETUP_MODE=true で起動してください" });
		}
		const state = await loadAuthState();
		if (!state.registrationEnabled) {
			return reply.code(403).send({ error: "登録エンドポイントは既に無効化されています" });
		}

		const options = await generateRegistrationOptions({
			rpName: env.WEBAUTHN_RP_NAME,
			rpID: env.WEBAUTHN_RP_ID,
			userName: SINGLE_USER_NAME,
			attestationType: "none",
			excludeCredentials: state.passkeys.map((p) => ({ id: p.credentialId })),
			authenticatorSelection: {
				residentKey: "preferred",
				userVerification: "required",
			},
		});

		state.currentChallenge = options.challenge;
		await saveAuthState(state);
		return options;
	});

	fastify.post("/register/verify", async (request, reply) => {
		const state = await loadAuthState();
		if (!env.SETUP_MODE && !state.registrationEnabled) {
			return reply.code(403).send({ error: "登録エンドポイントは無効です" });
		}
		if (!state.registrationEnabled) {
			return reply.code(403).send({ error: "登録エンドポイントは既に無効化されています" });
		}
		if (!state.currentChallenge) {
			return reply.code(403).send({ error: "登録セッションが見つかりません" });
		}
		const body = verifyBodySchema.parse(request.body);

		const verification = await verifyRegistrationResponse({
			response: body.response as never,
			expectedChallenge: state.currentChallenge,
			expectedOrigin: [env.WEBAUTHN_ORIGIN, "http://localhost:5173"],
			expectedRPID: [env.WEBAUTHN_RP_ID, "localhost"],
		});

		if (!verification.verified || !verification.registrationInfo) {
			return reply.code(400).send({ error: "パスキー登録の検証に失敗しました" });
		}

		const { credential } = verification.registrationInfo;
		state.passkeys.push({
			credentialId: credential.id,
			publicKey: Buffer.from(credential.publicKey).toString("base64url"),
			counter: credential.counter,
			transports: credential.transports as never,
		});
		state.currentChallenge = undefined;
		state.registrationEnabled = false;

		let recoveryCode: string | undefined;
		if (!state.recoveryCodeHash) {
			recoveryCode = generateRecoveryCode();
			state.recoveryCodeHash = hashCode(recoveryCode);
			state.recoveryCodeUsed = false;
		}

		await saveAuthState(state);

		await audit.record({
			actor: SINGLE_USER_ID,
			action: "auth.passkey.register",
			severity: "critical",
		});

		return { verified: true, recoveryCode };
	});

	fastify.get("/login/options", async () => {
		const state = await loadAuthState();
		const options = await generateAuthenticationOptions({
			rpID: env.WEBAUTHN_RP_ID,
			userVerification: "required",
			allowCredentials: state.passkeys.map((p) => ({ id: p.credentialId })),
		});
		state.currentChallenge = options.challenge;
		await saveAuthState(state);
		return options;
	});

	fastify.post("/login/verify", async (request, reply) => {
		const state = await loadAuthState();
		if (!state.currentChallenge) {
			return reply.code(400).send({ error: "ログインセッションが見つかりません" });
		}
		const body = verifyBodySchema.parse(request.body);
		const credentialIdFromClient = (body.response as { id?: string }).id;
		const stored = state.passkeys.find((p) => p.credentialId === credentialIdFromClient);
		if (!stored) {
			return reply.code(401).send({ error: "登録されていないパスキーです" });
		}

		const verification = await verifyAuthenticationResponse({
			response: body.response as never,
			expectedChallenge: state.currentChallenge,
			expectedOrigin: [env.WEBAUTHN_ORIGIN, "http://localhost:5173"],
			expectedRPID: [env.WEBAUTHN_RP_ID, "localhost"],
			credential: {
				id: stored.credentialId,
				publicKey: Buffer.from(stored.publicKey, "base64url"),
				counter: stored.counter,
				transports: stored.transports,
			},
		});

		if (!verification.verified) {
			return reply.code(401).send({ error: "認証に失敗しました" });
		}

		stored.counter = verification.authenticationInfo.newCounter;
		state.currentChallenge = undefined;
		await saveAuthState(state);

		const token = jwt.sign({ sub: SINGLE_USER_ID }, env.JWT_SECRET, {
			expiresIn: `${env.SESSION_TTL_MINUTES}m`,
		});

		await audit.record({ actor: SINGLE_USER_ID, action: "auth.login", severity: "info" });

		return { token, expiresInMinutes: env.SESSION_TTL_MINUTES };
	});

	fastify.post("/recover", async (request, reply) => {
		const state = await loadAuthState();
		if (!state.recoveryCodeHash) {
			return reply.code(400).send({ error: "リカバリーコードが設定されていません" });
		}
		if (state.recoveryCodeUsed) {
			return reply.code(400).send({ error: "リカバリーコードは既に使用済みです" });
		}

		const body = recoverBodySchema.parse(request.body);
		const inputHash = hashCode(body.code.toUpperCase().replace(/[^A-Z2-9]/g, ""));
		if (inputHash !== state.recoveryCodeHash) {
			await audit.record({
				actor: "unknown",
				action: "auth.recovery.failed",
				severity: "warning",
			});
			return reply.code(401).send({ error: "リカバリーコードが正しくありません" });
		}

		state.recoveryCodeUsed = true;
		state.registrationEnabled = true;
		await saveAuthState(state);

		await audit.record({
			actor: SINGLE_USER_ID,
			action: "auth.recovery.used",
			severity: "critical",
			detail: { note: "リカバリーコードが使用されました。不正アクセスでないか確認してください。" },
		});

		const options = await generateRegistrationOptions({
			rpName: env.WEBAUTHN_RP_NAME,
			rpID: env.WEBAUTHN_RP_ID,
			userName: SINGLE_USER_NAME,
			attestationType: "none",
			excludeCredentials: state.passkeys.map((p) => ({ id: p.credentialId })),
			authenticatorSelection: {
				residentKey: "preferred",
				userVerification: "required",
			},
		});

		state.currentChallenge = options.challenge;
		await saveAuthState(state);

		return options;
	});
};

export function requireAuth(env: ApiModuleContext["env"]) {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		if (env.LEGACY_TOKEN_AUTH) return;

		const header = request.headers.authorization;
		const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
		if (!token) {
			return reply.code(401).send({ error: "認証が必要です" });
		}
		try {
			jwt.verify(token, env.JWT_SECRET);
		} catch {
			return reply.code(401).send({ error: "セッションが無効です" });
		}
	};
}

export default authModule;
