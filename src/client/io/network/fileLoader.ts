export async function loadImageFromBin(
  url: string,
  keyHex: string,
): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch asset: ${res.status}`);

  const buffer = await res.arrayBuffer();
  const data = new Uint8Array(buffer);
  const keyBytes = hexToBytes(keyHex);

  for (let i = 0; i < data.length; i++) {
    data[i] ^= keyBytes[i % keyBytes.length];
  }

  const blob = new Blob([data], { type: 'image/png' });
  return createImageBitmap(blob);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
