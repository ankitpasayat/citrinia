import type { Metadata } from "next";
import { FollowPage } from "../follow-page";

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ before?: string }>;
};

export const metadata: Metadata = { title: "Followers" };

export default async function Followers({ params, searchParams }: Props) {
  const { username } = await params;
  const { before } = await searchParams;
  return <FollowPage username={username} side="followers" before={before} />;
}
