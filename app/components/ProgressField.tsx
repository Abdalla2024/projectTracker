"use client";

import { useState } from "react";

/** Slider for how far along a project is (0-100). */
export function ProgressField({ id, defaultValue = 0 }: { id: string; defaultValue?: number }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="slider">
      <input id={id} name="progress" type="range" min={0} max={100} step={5} value={value} onChange={(e) => setValue(Number(e.target.value))} style={{ ["--fill" as string]: `${value}%` }} />
      <output htmlFor={id}>{value}%</output>
    </div>
  );
}
