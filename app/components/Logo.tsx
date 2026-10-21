import Image from "next/image";

/** Ekiben badge (public/ekiben-logo.png). */
export function Logo({ size = 40 }: { size?: number }) {
  return <Image src="/ekiben-logo.png" alt="Ekiben" width={size} height={size} priority />;
}
