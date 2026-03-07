import { beforeAll, describe, it, expect } from "vitest";
import {
  Account,
  createWalletClient,
  Hex,
  http,
  WalletClient,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { TestBed } from "./test/testbed.js";
import { deployContract } from "./deployContract.js";
import { FheData } from "./types/index.js";

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Environment variable ${key} is not set`);
  return value;
};

describe("Fangorn FHE encryption and storage", () => {
  let jwt: string;
  let gateway: string;

  let delegatorAccount: Account;
  let delegatorWalletClient: WalletClient;

  let dataSourceRegistryAddress: Address;

  let rpcUrl: string;
  let chainName: string;
  let caip2: number;

  let testbed: TestBed;

  beforeAll(async () => {
    chainName = getEnv("CHAIN_NAME");
    rpcUrl = getEnv("CHAIN_RPC_URL");
    jwt = getEnv("PINATA_JWT");
    gateway = getEnv("PINATA_GATEWAY");
    caip2 = parseInt(getEnv("CAIP2"));

    const chain = chainName === "baseSepolia" ? baseSepolia : arbitrumSepolia;

    delegatorAccount = privateKeyToAccount(
      getEnv("DELEGATOR_ETH_PRIVATE_KEY") as Hex,
    );

    delegatorWalletClient = createWalletClient({
      account: delegatorAccount,
      transport: http(rpcUrl),
      chain,
    });

    dataSourceRegistryAddress = process.env.DS_REGISTRY_ADDR as Address;
    if (!dataSourceRegistryAddress) {
      console.log("Deploying DSRegistry Contract...");
      const deployment = await deployContract({
        account: delegatorAccount,
        contractName: "DSRegistry",
        constructorArgs: [],
        chain,
      });
      dataSourceRegistryAddress = deployment.address;
    }

    console.log(`Data Source Registry: ${dataSourceRegistryAddress}`);

    testbed = await TestBed.init(
      delegatorWalletClient,
	  // delegatee same as delegator for now
      delegatorWalletClient,
      jwt,
      gateway,
      dataSourceRegistryAddress,
      rpcUrl,
      "arbitrumSepolia",
      caip2,
    );
  }, 120_000);

  it("should FHE-encrypt a u64, store the ciphertext, and verify it is retrievable", async () => {
    const datasourceName = `fhe_test_${Date.now()}`;

    // register datasource
    const id = await testbed.registerDatasource(datasourceName);
    expect(id).toBeTruthy();
    console.log(`Datasource registered: ${id}`);

    // verify it exists on-chain
    const exists = await testbed.checkDatasourceRegistryExistence(
      delegatorAccount.address,
      datasourceName,
    );
    expect(exists).toBe(true);

    // data to encrypt
    const tag = "sensor-reading-1";
    const data: FheData[] = [
      {
        tag,
		// plaintext
        value: 42n,
        fileType: "fhe/uint64",
      },
    ];

    const computeDescriptor = {
      type: "facilitator-x402",
      description: "Facilitator-gated FHE computation (mocked)",
    };

    // encrypt and upload
    const manifestCid = await testbed.encryptAndUpload(
      datasourceName,
      data,
      computeDescriptor,
    );
    expect(manifestCid).toBeTruthy();
    console.log(`Manifest stored at CID: ${manifestCid}`);

    // wait for Pinata to propagate
    await new Promise((resolve) => setTimeout(resolve, 4_000));

    // verify the entry exists in the manifest
    await testbed.checkDataExistence(
      delegatorAccount.address,
      datasourceName,
      tag,
    );

    // retrieve the raw ciphertext from storage and verify it's non-empty
    const entry = await testbed.delegatorFangorn.getDataSourceData(
      delegatorAccount.address,
      datasourceName,
      tag,
    );
    expect(entry.cid).toBeTruthy();
    console.log(`Ciphertext stored at CID: ${entry.cid}`);

    // fetch the actual ciphertext payload and sanity check structure
    const ciphertext = await testbed.storage.retrieve(entry.cid);
    expect(ciphertext).toBeTruthy();
	// // FHE encrypted u64
    // expect((ciphertext as any).data).toBeTruthy();
	// // cofhejs permit
    // expect((ciphertext as any).permission).toBeTruthy(); 

    console.log("FHE ciphertext stored and retrieved successfully.");
    console.log("Next step: facilitator pays => executes => caller unseals (mocked until FHE contract is ready).");
  }, 120_000);
});