import type { FilecoinChain } from "@filoz/synapse-core/chains";
import { type Address, type Chain, type Client, isAddressEqual, type Transport } from "viem";
import { readContract } from "viem/actions";
import type { DataSetHealth, DataSetPin } from "./types.js";

/**
 * Data set health from PDPVerifier reads plus the FWSS StateView (address resolved through
 * FWSS.viewContractAddress(), falling back to the chain constant). View failures are tolerated
 * (viewOk:false), PDPVerifier failures are not.
 */
export async function readDataSetHealth(
  client: Client<Transport, Chain>,
  chain: FilecoinChain,
  pin: DataSetPin,
): Promise<DataSetHealth> {
  const pdp = { address: chain.contracts.pdp.address, abi: chain.contracts.pdp.abi } as const;
  const args = [pin.id] as const;
  const [live, listener, lastProvenEpoch, nextChallengeEpoch] = await Promise.all([
    readContract(client, { ...pdp, functionName: "dataSetLive", args }),
    readContract(client, { ...pdp, functionName: "getDataSetListener", args }),
    readContract(client, { ...pdp, functionName: "getDataSetLastProvenEpoch", args }),
    readContract(client, { ...pdp, functionName: "getNextChallengeEpoch", args }),
  ]);
  const out: DataSetHealth = {
    dataSetId: pin.id,
    live,
    listenerIsFwss: isAddressEqual(listener as Address, chain.contracts.fwss.address),
    lastProvenEpoch,
    nextChallengeEpoch,
    provenThisPeriod: null,
    provingDeadline: null,
    pdpEndEpoch: null,
    lifecycleReserve: null,
    providerId: pin.providerId,
    viewOk: false,
  };
  try {
    let viewAddress: Address = chain.contracts.fwssView.address;
    try {
      viewAddress = await readContract(client, {
        address: chain.contracts.fwss.address,
        abi: chain.contracts.fwss.abi,
        functionName: "viewContractAddress",
      });
    } catch {
      // keep the chain constant
    }
    const view = { address: viewAddress, abi: chain.contracts.fwssView.abi } as const;
    const [proven, deadline, ds] = await Promise.all([
      readContract(client, { ...view, functionName: "provenThisPeriod", args }),
      readContract(client, { ...view, functionName: "provingDeadline", args }),
      readContract(client, { ...view, functionName: "getDataSet", args }),
    ]);
    out.provenThisPeriod = proven;
    out.provingDeadline = deadline;
    out.pdpEndEpoch = ds.pdpEndEpoch;
    out.lifecycleReserve = BigInt(ds.lifecycleReserveBalance);
    if (ds.providerId > 0n) out.providerId = ds.providerId;
    out.viewOk = true;
  } catch {
    out.viewOk = false;
  }
  return out;
}
