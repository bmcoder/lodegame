import { GameCanvas } from "@/app/components/GameCanvas";

export default async function GamePage({ params }: { params: Promise<{ levelId: string }> }) {
  const { levelId } = await params;
  return <GameCanvas levelId={Number(levelId) || 1} />;
}
