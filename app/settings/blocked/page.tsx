import type { Metadata } from "next";
import { PeoplePage } from "../people-page";

export const metadata: Metadata = { title: "Blocked" };

export default async function Blocked({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const { before } = await searchParams;
  return <PeoplePage kind="blocked" before={before} />;
}
