import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A Tailwind class string as is: for IntelliSense, as `cn` gets */
export const tw = (classes: string) => classes;
