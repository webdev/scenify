import sharp from "sharp";

export async function resizeToTarget(
  inputBuffer: Buffer,
  target: { width: number; height: number },
): Promise<{ buffer: Buffer; mimeType: string }> {
  const meta = await sharp(inputBuffer).metadata();
  if (
    meta.width === target.width &&
    meta.height === target.height &&
    (meta.format === "jpeg" || meta.format === "jpg")
  ) {
    return { buffer: inputBuffer, mimeType: "image/jpeg" };
  }

  const buffer = await sharp(inputBuffer)
    .resize(target.width, target.height, {
      fit: "cover",
      position: "attention",
      withoutEnlargement: false,
    })
    .jpeg({ quality: 92, progressive: true, mozjpeg: true })
    .toBuffer();

  return { buffer, mimeType: "image/jpeg" };
}
