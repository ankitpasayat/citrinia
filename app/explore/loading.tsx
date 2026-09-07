import { Column } from "@/components/column";
import { PeelSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <Column>
      <PeelSkeleton />
      <PeelSkeleton />
      <PeelSkeleton />
    </Column>
  );
}
