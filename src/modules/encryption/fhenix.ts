import { createPublicClient, http, WalletClient } from "viem";
import { FheInputData } from "../../types";
import { EncryptionService } from ".";
import { createRequire } from "module";
import { arbitrumSepolia } from "viem/chains";

const require = createRequire(import.meta.url);
const { cofhejs, Encryptable, FheTypes } = require("cofhejs/node");

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
			generatePermit: false,
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

	async unseal(encryptedResult: any, wallet: WalletClient): Promise<any> {
		const permitResult = await cofhejs.createPermit({
			type: "self",
			issuer: wallet.account?.address,
		});

		if (!permitResult.success) {
			console.error("Failed to create permit:", permitResult.error);
			return;
		}

		const permit = permitResult.data;

		// Step 8: Unseal the encrypted value
		// When creating a permit, cofhejs will use it automatically,
		// but you can pass it manually as well for explicit control
		const unsealResult = await cofhejs.unseal(
			encryptedResult,
			FheTypes.Uint32,
			permit.issuer,
			permit.getHash(),
		);

		if (!unsealResult.success) {
			console.error("Failed to unseal counter:", unsealResult.error);
			return;
		}

		console.log("Unsealed counter value:", unsealResult.data.toString());
		return unsealResult.data;
	}
}
