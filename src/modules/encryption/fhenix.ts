import { createPublicClient, http, WalletClient } from "viem";
import { FheInputData } from "../../types";
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

	async encrypt(data: FheInputData): Promise<any> {
		const dataArray = [];
		for (const entry in data.value) {
			dataArray.push(Encryptable.uint32(entry));
		}
		const result = await cofhejs.encrypt({
			permission: "permission",
			data: dataArray,
		} as any);

		return result;
	}
}
