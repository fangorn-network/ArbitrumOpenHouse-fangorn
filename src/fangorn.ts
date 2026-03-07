import { Address, createPublicClient, Hex, http, WalletClient } from "viem";
import {
	Vault,
	DataSourceRegistry,
} from "./interface/datasource-registry/dataSourceRegistry.js";
import {
	ComputeDescriptor,
	FheData,
	Filedata,
	PendingEntry,
	VaultManifest,
} from "./types/index.js";
import StorageProvider from "./providers/storage/index.js";
import { AppConfig, FangornConfig } from "./config.js";
import { EncryptionService } from "./modules/encryption/index.js";

/**
 *
 */
export class Fangorn {
	// data ingestion staging
	private pendingEntries: Map<string, PendingEntry> = new Map();

	constructor(
		private dataSourceRegistry: DataSourceRegistry,
		private walletClient: WalletClient,
		private storage: StorageProvider<any>,
		private encryptionService: EncryptionService,
	) {}

	public static async init(
		walletClient: WalletClient,
		storage: StorageProvider<any>,
		encryptionService: EncryptionService,
		config?: AppConfig,
	): Promise<Fangorn> {
		const resolvedConfig = config || FangornConfig.ArbitrumSepolia;

		const publicClient = createPublicClient({
			transport: http(resolvedConfig.rpcUrl),
		});

		const dataSourceRegistry = new DataSourceRegistry(
			resolvedConfig.dataSourceRegistryContractAddress,
			publicClient as any,
			walletClient,
		);

		return new Fangorn(
			dataSourceRegistry,
			walletClient,
			storage,
			encryptionService,
		);
	}

	getStorage(): StorageProvider<any> {
		return this.storage;
	}

	/**
	 * Register a new named data source owned by the current wallet.
	 */
	async registerDataSource(name: string, agentId?: string): Promise<Hex> {
		return await this.dataSourceRegistry.registerDataSource(
			name,
			agentId || "",
		);
	}

	/**
	 * Upload files to a vault with the given gadget for access control.
	 */
	async upload(
		name: string,
		data: FheData[],
		computeDescriptor: ComputeDescriptor,
		overwrite?: boolean,
	): Promise<string> {
		const who = this.walletClient.account.address;
		const datasource = await this.dataSourceRegistry.getDataSource(who, name);

		if (datasource.manifestCid && !overwrite) {
			const oldManifest = await this.fetchManifest(datasource.manifestCid);
			this.loadManifest(oldManifest);
			try {
				await this.storage.delete(datasource.manifestCid);
			} catch (e) {
				console.warn("Failed to unpin old manifest:", e);
			}
		}

		for (const item of data) {
			await this.addFile(item, computeDescriptor);
		}

		return await this.commit(name);
	}

	async addFile(
		data: FheData,
		computeDescriptor: ComputeDescriptor,
	): Promise<{ cid: string }> {
		const account = this.walletClient.account;
		if (!account?.address) throw new Error("Wallet not connected");

		const encrypted = await this.encryptionService.encrypt(data);

		const cid = await this.storage.store(encrypted, {
			metadata: { name: data.tag },
		});

		this.pendingEntries.set(data.tag, {
			tag: data.tag,
			cid,
			computeDescriptor,
		});

		return { cid };
	}

	/**
	 * Remove a staged file before committing.
	 */
	removeFile(tag: string): boolean {
		return this.pendingEntries.delete(tag);
	}

	/**
	 * Commit all staged files to the vault.
	 */
	async commit(name: string): Promise<string> {
		if (this.pendingEntries.size === 0) {
			throw new Error("No files to commit");
		}

		const entries = Array.from(this.pendingEntries.values());

		const manifest: VaultManifest = {
			version: 1,
			entries: entries.map((e, i) => ({
				tag: e.tag,
				cid: e.cid,
				index: i,
				computeDescriptor: e.computeDescriptor,
			})),
			tree: [],
		};

		const manifestCid = await this.storage.store(manifest, {
			metadata: { name: `manifest-${name}` },
		});

		const hash = await this.dataSourceRegistry.updateDataSource(
			name,
			manifestCid,
		);
		await this.dataSourceRegistry.waitForTransaction(hash);

		this.pendingEntries.clear();
		return manifestCid;
	}

	// Read operations

	// fetch the data source info
	async getDataSource(owner: Address, name: string): Promise<Vault> {
		return await this.dataSourceRegistry.getDataSource(owner, name);
	}

	registry(): DataSourceRegistry {
		return this.dataSourceRegistry;
	}

	// Get the manifest for a given data source
	async getManifest(
		owner: Address,
		name: string,
	): Promise<VaultManifest | undefined> {
		const vault = await this.getDataSource(owner, name);
		if (!vault.manifestCid || vault.manifestCid === "") {
			return undefined;
		}
		return await this.fetchManifest(vault.manifestCid);
	}

	// attempt to get specific data from the data source
	async getDataSourceData(owner: Address, name: string, tag: string) {
		const manifest = await this.getManifest(owner, name);
		if (!manifest) {
			throw new Error("Vault has no manifest");
		}
		const entry = manifest.entries.find((e) => e.tag === tag);
		if (!entry) {
			throw new Error(`Entry not found: ${tag}`);
		}

		return entry;
	}

	getAddress(): Hex {
		const account = this.walletClient.account;
		if (!account?.address) throw new Error("Wallet not connected");
		return account.address;
	}

	async fetchManifest(cid: string): Promise<VaultManifest> {
		return (await this.storage.retrieve(cid)) as unknown as VaultManifest;
	}

	// helpers

	private loadManifest(oldManifest: VaultManifest): void {
		for (const entry of oldManifest.entries) {
			this.pendingEntries.set(entry.tag, {
				tag: entry.tag,
				cid: entry.cid,
				computeDescriptor: entry.computeDescriptor,
			});
		}
	}
}
