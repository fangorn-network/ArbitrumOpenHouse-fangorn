
export interface FheData {
  tag: string;
  // the u64 to encrypt
  value: bigint;
  // keep for manifest compat
  extension?: string;
  fileType?: string;
}

export interface ComputeDescriptor {
  // ex: "x402f facilitator"	
  type: string;
  // a human-readable description 
  description?: string;
  // the FHE contract to call
  contractAddress?: string;
  // the function the facilitator calls
  functionName?: string;
}

export interface VaultEntry {
	tag: string;
	cid: string;
	computeDescriptor: ComputeDescriptor;
}

export interface VaultManifest {
	version: number;
	entries: VaultEntry[];
	tree?: string[][];
}

interface BuildManifestOptions {
	root: string;
	entries: VaultEntry[];
	tree?: string[][];
}

export const buildManifest = (options: BuildManifestOptions): VaultManifest => {
	const { root, entries, tree } = options;

	return {
		version: 1,
		entries,
		...(tree && { tree }),
	};
};

// intermediate entry struct
export interface PendingEntry {
	tag: string;
	cid: string;
	computeDescriptor: ComputeDescriptor;
}

export interface Filedata {
	tag: string;
	data: string;
	extension: string;
	fileType: string;
}

export interface EncryptedData {
	ciphertext: Uint8Array<ArrayBuffer>;
	iv: Uint8Array<ArrayBuffer>;
	authTag: Uint8Array<ArrayBuffer>;
	salt: Uint8Array<ArrayBuffer>;
}
