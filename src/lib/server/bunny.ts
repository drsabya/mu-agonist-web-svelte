// src/lib/server/bunny.ts
// import * as BunnySDK from "@bunny.net/edgescript-sdk";
import * as BunnyStorageSDK from '@bunny.net/storage-sdk';

const szZone = process.env.BUNNY_STORAGE_ZONE!;
const accessKey = process.env.BUNNY_ACCESS_KEY!;

// ⚡ Choose your region here; Falkenstein is usually default
const region = BunnyStorageSDK.regions.StorageRegion.Falkenstein;

// Connect to Bunny storage zone
export const storageZone = BunnyStorageSDK.zone.connect_with_accesskey(region, szZone, accessKey);
