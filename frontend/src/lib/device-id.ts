import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

const KEY = "docuall.device_id";
let cached: string | null = null;
let pending: Promise<string> | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  if (!pending) {
    pending = loadDeviceId().finally(() => { pending = null; });
  }
  return pending;
}

async function loadDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) {
    cached = existing;
    return existing;
  }
  const id = Crypto.randomUUID();
  await AsyncStorage.setItem(KEY, id);
  cached = id;
  return id;
}

