import { createFileRoute } from "@tanstack/react-router";
import { GameApp } from "@/components/game-app";
import type { Mode } from "@/game/types";

type Search = {
  room?: string;
  mode?: string;
};

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    room: typeof search.room === "string" ? search.room : undefined,
    mode: typeof search.mode === "string" ? search.mode : undefined,
  }),
  component: Home,
});

function Home() {
  const { room, mode } = Route.useSearch();
  const initialMode: Mode | undefined = mode === "friends" ? "friends" : undefined;
  return <GameApp initialMode={initialMode} initialRoom={room} />;
}
