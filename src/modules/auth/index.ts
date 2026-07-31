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

const verifyBodySchema = z.object({
	response: z.record(z.unknown()),
});

/**
 * パスキー(WebAuthn/FIDO2)認証モジュール。
 * 単一ユーザー運用、ノードごとに個別登録する設計(Notion設計「認証設計」参照)。
 *
 * TODO: これはスキャフォールドです。本番投入前に以下を必ず実装すること
 *  - リカバリーコードの発行・失効・Discord通知
 *  - 予備パスキー(複数デバイス)の登録フロー
 *  - レート制限・ロックアウト
 */
const authModule: FastifyPluginAsync<{ ctx: ApiModuleContext }> = async (fastify, opts) => {
	const { env, audit } = opts.ctx;

	fastify.get("/status", async () => {
		const state = await loadAuthState();
		return {
			registrationEnabled: state.registrationEnabled,
			passkeyCount: state.passkeys.length,
		};
	});

	fastify.post("/registration/options", async (request, reply) => {
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

	fastify.post("/registration/verify", async (request, reply) => {
		const state = await loadAuthState();
		if (!state.registrationEnabled || !state.currentChallenge) {
			return reply.code(403).send({ error: "登録セッションが見つかりません" });
		}
		const body = verifyBodySchema.parse(request.body);

		const verification = await verifyRegistrationResponse({
			// biome-ignore lint: simplewebauthnの型はレスポンス形式に依存するためスキャフォールドではunknownを許容
			response: body.response as never,
			expectedChallenge: state.currentChallenge,
			expectedOrigin: env.WEBAUTHN_ORIGIN,
			expectedRPID: env.WEBAUTHN_RP_ID,
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
		await saveAuthState(state);

		await audit.record({
			actor: SINGLE_USER_ID,
			action: "auth.passkey.register",
			severity: "critical",
		});

		return { verified: true };
	});

	fastify.post("/login/options", async () => {
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
			// biome-ignore lint: 上記と同様スキャフォールド上の簡略化
			response: body.response as never,
			expectedChallenge: state.currentChallenge,
			expectedOrigin: env.WEBAUTHN_ORIGIN,
			expectedRPID: env.WEBAUTHN_RP_ID,
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
		// 初回ログイン成功後、登録エンドポイントを恒久的に無効化する
		state.registrationEnabled = state.registrationEnabled && state.passkeys.length === 0;
		await saveAuthState(state);

		const token = jwt.sign({ sub: SINGLE_USER_ID }, env.JWT_SECRET, {
			expiresIn: `${env.SESSION_TTL_MINUTES}m`,
		});

		await audit.record({ actor: SINGLE_USER_ID, action: "auth.login", severity: "info" });

		return { token, expiresInMinutes: env.SESSION_TTL_MINUTES };
	});
};

/** 他モジュールから使う認証フック。Authorization: Bearer <token> を検証する */
export function requireAuth(env: ApiModuleContext["env"]) {
	return async (request: FastifyRequest, reply: FastifyReply) => {
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
