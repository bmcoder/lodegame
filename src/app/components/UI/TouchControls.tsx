"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bomb, Crosshair, Pickaxe, Zap } from "lucide-react";

const buttons = [
  { action: "left", label: "Left", icon: <ArrowLeft size={20} /> },
  { action: "right", label: "Right", icon: <ArrowRight size={20} /> },
  { action: "up", label: "Up", icon: <ArrowUp size={20} /> },
  { action: "down", label: "Down", icon: <ArrowDown size={20} /> },
  { action: "jump", label: "Jump", icon: <Bomb size={20} /> },
  { action: "shoot", label: "Shoot", icon: <Crosshair size={20} /> },
  { action: "dig", label: "Dig", icon: <Pickaxe size={20} /> },
  { action: "super", label: "Super", icon: <Zap size={20} /> },
];

function dispatch(action: string, active: boolean) {
  window.dispatchEvent(new CustomEvent("lodegame:control", { detail: { action, active } }));
}

export function TouchControls() {
  return (
    <div className="grid grid-cols-4 gap-2 md:hidden">
      {buttons.map((button) => (
        <button
          key={button.action}
          aria-label={button.label}
          className="grid h-12 place-items-center rounded-md border border-white/15 bg-white/10 active:bg-cyan-300 active:text-slate-950"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dispatch(button.action, true);
          }}
          onPointerUp={() => dispatch(button.action, false)}
          onPointerCancel={() => dispatch(button.action, false)}
          onPointerLeave={() => dispatch(button.action, false)}
        >
          {button.icon}
        </button>
      ))}
    </div>
  );
}
