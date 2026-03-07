import { createPublicClient, http, WalletClient } from "viem";
import { FheData } from "../../types";
import { EncryptionService } from ".";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { cofhejs, Encryptable } = require("cofhejs/node");

export class FhenixEncryptionService implements EncryptionService {
  constructor() {}

  public static async init(
    walletClient: WalletClient,
    rpcUrl: string,
  ): Promise<FhenixEncryptionService> {
    const publicClient = createPublicClient({
      transport: http(rpcUrl),
    });

    await cofhejs.initializeWithViem({
      viemClient: publicClient,
      viemWalletClient: walletClient,       
    });

    await cofhejs.createPermit();
    return new FhenixEncryptionService();
  }

  async encrypt(data: FheData): Promise<any> {
    const result = await cofhejs.encrypt({
      permission: "permission",
      data: Encryptable.uint64(data.value),
    } as any);

    return result;
  }

}