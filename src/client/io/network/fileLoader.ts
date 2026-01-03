export async function loadImageFromBin(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const data = new Uint8Array(buffer);

  for (let i = 0; i < data.length; i++) {
    data[i] ^= 0xa5;
  }

  const blob = new Blob([data], { type: 'image/png' });
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = reject;
    img.src = objectUrl;
  });
}
