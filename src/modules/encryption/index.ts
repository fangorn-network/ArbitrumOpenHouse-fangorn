import { WalletClient } from "viem";
import { FheData } from "../../types";

export interface EncryptionService {
	encrypt(data: FheData): Promise<any>;
	createAuthContext?: (walletClient: WalletClient, domain: string) => Promise<any>;
}
/**
 * Auth context needed for Lit decryption
 */
export interface AuthContext {
	authSig: AuthSig;
	sessionContext?: unknown; // Lit's session stuff
}

export interface AuthSig {
	sig: string;
	derivedVia: string;
	signedMessage: string;
	address: string;
}
