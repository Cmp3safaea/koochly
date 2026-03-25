"use client";

import { useRouter } from "next/navigation";

export default function BackToCityButton({
  className,
  label,
}: {
  className?: string;
  label: string;
}) {
  const router = useRouter();

  return (
    <button type="button" onClick={() => router.back()} className={className}>
      {label}
    </button>
  );
}
