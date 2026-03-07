import { createPublicClient, http, WalletClient } from "viem";
import { FheData } from "../../types";
import { EncryptionService } from ".";
import { createRequire } from "module";
import { arbitrumSepolia } from "viem/chains";

const require = createRequire(import.meta.url);
const { cofhejs, Encryptable } = require("cofhejs/node");

export class FhenixEncryptionService implements EncryptionService {
	constructor() {}

	public static async init(
		walletClient: WalletClient,
		rpcUrl: string,
	): Promise<FhenixEncryptionService> {
		const publicClient = createPublicClient({
			chain: arbitrumSepolia,
			transport: http(rpcUrl),
		});

		// we want everyone to be able to get a permit
		const initResult = await cofhejs.initializeWithViem({
			viemClient: publicClient,
			viemWalletClient: walletClient,
			generatePermit: true,
			environment: "TESTNET",
		});

		if (!initResult.success) {
			console.error("Failed to initialize cofhejs:", initResult.error);
			process.exit(1);
		}

		await cofhejs.createPermit();
		return new FhenixEncryptionService();
	}

	async encrypt(data: FheData): Promise<any> {
		const result = await cofhejs.encrypt({
			permission: "permission",
			data: Encryptable.uint32(data.value),
		} as any);

		return result;
	}
}
