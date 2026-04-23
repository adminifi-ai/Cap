"use server";

import { db } from "@cap/database";
import { isEmailAllowedForSignup } from "@cap/database/auth/domain-utils";
import { users } from "@cap/database/schema";
import { serverEnv } from "@cap/env";
import { eq } from "drizzle-orm";

export async function isEmailAuthorizedForAuth(email: string): Promise<{
	allowed: boolean;
	reason?: "invalid" | "not_allowlisted";
}> {
	const normalized = email.trim().toLowerCase();
	if (!normalized.includes("@")) {
		return { allowed: false, reason: "invalid" };
	}

	const allowedDomains = serverEnv().CAP_ALLOWED_SIGNUP_DOMAINS;
	const allowedEmails = serverEnv().CAP_ALLOWED_SIGNUP_EMAILS;
	if (!allowedDomains && !allowedEmails) return { allowed: true };

	const [existingUser] = await db()
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, normalized))
		.limit(1);

	if (existingUser) return { allowed: true };

	if (isEmailAllowedForSignup(normalized, allowedDomains, allowedEmails)) {
		return { allowed: true };
	}

	return { allowed: false, reason: "not_allowlisted" };
}
