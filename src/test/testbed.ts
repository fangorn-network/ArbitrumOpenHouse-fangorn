import {
	Address,
	Chain,
	Hex,
	keccak256,
	parseUnits,
	toHex,
	WalletClient,
	createPublicClient,
	http,
} from "viem";
import { Fangorn } from "../fangorn.js";
import { ComputeDescriptor, FheInputData } from "../types/index.js";
import { PinataStorage } from "../providers/storage/pinata/index.js";
import { AppConfig } from "../config.js";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { SettlementTracker } from "../interface/settlement-tracker/settlementTracker.js";
import { computeTagCommitment, fieldToHex } from "../utils/index.js";
import { FhenixEncryptionService } from "../modules/encryption/fhenix.js";

export class TestBed {
	// fangorn instances
	public delegatorFangorn: Fangorn;
	public delegateeFangorn: Fangorn;
	public storage: PinataStorage;

	private delegatorAddress: Address;
	private usdcContractAddress: Address;
	private vaultIds: Map<string, Hex>;
	private config: AppConfig;

	constructor(
		delegatorAddress: Address,
		delegatorFangorn: Fangorn,
		delegateeFangorn: Fangorn,
		storage: PinataStorage,
		config: AppConfig,
	) {
		this.delegatorAddress = delegatorAddress;
		this.delegatorFangorn = delegatorFangorn;
		this.delegateeFangorn = delegateeFangorn;
		this.vaultIds = new Map();
		this.config = config;
		this.storage = storage;
	}

	public static async init(
		delegatorWalletClient: WalletClient,
		delegateeWalletClient: WalletClient,
		jwt: string,
		gateway: string,
		dataSourceRegistryContractAddress: Hex,
		rpcUrl: string,
		chain: string,
		caip2: number,
	) {
		let chainImpl: Chain = arbitrumSepolia;
		if (chain === "baseSepolia") {
			chainImpl = baseSepolia;
		}

		const config: AppConfig = {
			dataSourceRegistryContractAddress,
			chainName: chain,
			chain: chainImpl,
			rpcUrl,
			caip2,
		};

		// Storage
		const storage = new PinataStorage(jwt, gateway);

		// Fangorn instances
		const delegatorFangorn = await Fangorn.init(
			delegatorWalletClient,
			storage,
			config,
		);

		const delegateeFangorn = await Fangorn.init(
			delegateeWalletClient,
			storage,
			config,
		);

		return new TestBed(
			delegatorWalletClient.account.address,
			delegatorFangorn,
			delegateeFangorn,
			storage,
			config,
		);
	}

	async registerDatasource(name: string): Promise<Hex> {
		const existing = this.vaultIds.get(name);
		if (existing) {
			return existing;
		}

		// we don't care about the agent id yet
		const id = await this.delegatorFangorn.registerDataSource(name, "");
		this.vaultIds.set(name, id);
		return id;
	}

	/**
	 * Encrypt a u64 with FHE and commit it to a vault
	 * with a compute descriptor
	 */
	async encryptAndUpload(
		datasourceName: string,
		data: FheInputData[],
		computeDescriptor: ComputeDescriptor,
	): Promise<string> {
		return await this.delegatorFangorn.upload(
			datasourceName,
			data,
			computeDescriptor,
		);
	}

	async checkDatasourceRegistryExistence(
		who: Address,
		name: string,
	): Promise<boolean> {
		const datasource = await this.delegatorFangorn.getDataSource(who, name);
		return datasource.owner == who.toString() && datasource.name == name;
	}

	async checkDataExistence(who: Address, name: string, tag: string) {
		// if there's no error then we're good
		await this.delegatorFangorn.getDataSourceData(who, name, tag);
	}

	async buildUsdcAuthorization(
		recipient: Address,
		amount: string,
		chainId: number,
		usdcContractName: string,
		usdcAddress: Address,
	) {
		const walletClient = this.delegateeFangorn["walletClient"];
		const account = walletClient.account!;
		const domain = {
			name: usdcContractName,
			version: "2",
			chainId: chainId,
			verifyingContract: usdcAddress,
		} as const;

		const types = {
			TransferWithAuthorization: [
				{ name: "from", type: "address" },
				{ name: "to", type: "address" },
				{ name: "value", type: "uint256" },
				{ name: "validAfter", type: "uint256" },
				{ name: "validBefore", type: "uint256" },
				{ name: "nonce", type: "bytes32" },
			],
		} as const;

		const value = parseUnits(amount, 6);
		const nonce = keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));

		const signature = await walletClient.signTypedData({
			account,
			domain,
			types,
			primaryType: "TransferWithAuthorization",
			message: {
				from: account.address,
				to: recipient,
				value,
				validAfter: 0n,
				validBefore: 281474976710655n,
				nonce,
			},
		});

		return {
			from: account.address,
			to: recipient,
			amount: value,
			validAfter: 0n,
			validBefore: 281474976710655n,
			nonce,
			signature,
		};
	}

	public async payForFile(
		owner: Address,
		name: string,
		tag: string,
		amount: string,
		usdcDomainName: string,
		settlementTrackerAddress: Address,
		walletClient: WalletClient,
		rpcUrl: string,
	) {
		const auth = await this.buildUsdcAuthorization(
			this.delegatorAddress,
			amount,
			this.config.caip2,
			usdcDomainName,
			this.usdcContractAddress,
		);

		const commitment = await computeTagCommitment(owner, name, tag, amount);
		const commitmentHex = fieldToHex(commitment);

		const publicClient = createPublicClient({
			transport: http(rpcUrl),
		});

		const settlementTracker = new SettlementTracker(
			settlementTrackerAddress,
			publicClient as any,
			walletClient,
		);

		await settlementTracker.pay({
			commitment: commitmentHex,
			from: auth.from,
			to: auth.to,
			value: auth.amount,
			validAfter: auth.validAfter,
			validBefore: auth.validBefore,
			nonce: auth.nonce,
			...this.parseSignature(auth.signature),
		});
	}

	private parseSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
		const r = `0x${signature.slice(2, 66)}` as Hex;
		const s = `0x${signature.slice(66, 130)}` as Hex;
		const v = parseInt(signature.slice(130, 132), 16);
		return { v, r, s };
	}
}
