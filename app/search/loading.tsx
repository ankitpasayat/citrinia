import { Band } from "@/components/band";
import { Column } from "@/components/column";
import { PeelSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <Column>
      <Band slim />
      <PeelSkeleton />
      <PeelSkeleton />
      <PeelSkeleton />
    </Column>
  );
}
