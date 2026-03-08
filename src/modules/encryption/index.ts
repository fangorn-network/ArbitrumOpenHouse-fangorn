import { WalletClient } from "viem";
import { FheInputData } from "../../types";

export * from "./fhenix.js";

export interface EncryptionService {
	encrypt(data: FheInputData): Promise<any>;
	createAuthContext?: (
		walletClient: WalletClient,
		domain: string,
	) => Promise<any>;
}
/**
 * Auth context needed for Lit decryption
 */
export interface AuthContext {
	authSig: AuthSig;
	// Lit's session stuff
	sessionContext?: unknown;
}

export interface AuthSig {
	sig: string;
	derivedVia: string;
	signedMessage: string;
	address: string;
}
