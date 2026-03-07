import { beforeAll, describe, it, expect } from "vitest";
import {
	Account,
	createWalletClient,
	Hex,
	http,
	WalletClient,
	createPublicClient,
	PublicClient,
	type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { TestBed } from "./test/testbed.js";
import { deployContract } from "./deployContract.js";
import { FheData } from "./types/index.js";
import PatientEvaluatorABI from "../../ArbitrumFoundersHouse/cofhe-hardhat-starter/artifacts/contracts/PatientEvaluator.sol/PatientEvaluator.json";
import { FhenixEncryptionService } from "./modules/encryption/fhenix.js";

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

	let patientEvaluatorContractAddress: Address;

	let publicClient: PublicClient;

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
		patientEvaluatorContractAddress = process.env
			.PATIENT_EVALUATOR_ADDR as Address;

		const chain = chainName === "baseSepolia" ? baseSepolia : arbitrumSepolia;

		publicClient = createPublicClient({
			chain: arbitrumSepolia,
			transport: http(rpcUrl),
		});

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
		const tag = "Patient Blood Data - 1";
		const patientData: FheData[] = [
			{
				tag,
				value: 0n,
			},
			{
				tag,
				value: 2n,
			},
			{
				tag,
				value: 2n,
			},
			{
				tag,
				value: 1n,
			},
		];

		const computeDescriptor = {
			type: "facilitator-x402",
			description: "Facilitator-gated FHE computation (mocked)",
			price: "0.0001",
		};

		// encrypt and upload
		const manifestCid = await testbed.encryptAndUpload(
			datasourceName,
			patientData,
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

		console.log("ciphertext");
		console.log(ciphertext);

		const hashCountMatch = await delegatorWalletClient.writeContract({
			address: patientEvaluatorContractAddress,
			abi: PatientEvaluatorABI.abi,
			functionName: "countMatch",
			args: [patientData],
		});

		const result = await publicClient.readContract({
			address: patientEvaluatorContractAddress,
			abi: PatientEvaluatorABI.abi,
			functionName: "getAllTypesCount",
		});

		console.log("Types count result: ", result);

		const hashReset = await delegatorWalletClient.writeContract({
			address: patientEvaluatorContractAddress,
			abi: PatientEvaluatorABI.abi,
			functionName: "reset",
		});

		const bloodType = {
			tag: "target blood type",
			// plaintext
			value: 2n,
			fileType: "fhe/uint32",
		};

		const bloodTypeEnc = testbed.delegatorFangorn
			.getEncryptionService()
			.encrypt(bloodType);

		const hashCountMatchSpecific = await delegatorWalletClient.writeContract({
			address: patientEvaluatorContractAddress,
			abi: PatientEvaluatorABI.abi,
			functionName: "countMatchSpecific",
		});

		const targetCount = await publicClient.readContract({
			address: patientEvaluatorContractAddress,
			abi: PatientEvaluatorABI.abi,
			functionName: "getMatchedTypeCount",
		});

		console.log("targetCount", targetCount);

		const hashReset2 = await delegatorWalletClient.writeContract({
			address: patientEvaluatorContractAddress,
			abi: PatientEvaluatorABI.abi,
			functionName: "reset",
		});

		// call contract
		// get result
		// unseal

		// // FHE encrypted u64
		// expect((ciphertext as any).data).toBeTruthy();
		// // cofhejs permit
		// expect((ciphertext as any).permission).toBeTruthy();

		console.log("FHE ciphertext stored and retrieved successfully.");
		console.log(
			"Next step: facilitator pays => executes => caller unseals (mocked until FHE contract is ready).",
		);
	}, 120_000);
});
