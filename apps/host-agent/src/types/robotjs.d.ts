declare module "robotjs" {
  export interface Point {
    x: number;
    y: number;
  }

  export interface Size {
    width: number;
    height: number;
  }

  export function moveMouse(x: number, y: number): void;
  export function moveMouseSmooth(x: number, y: number, speed?: number): void;
  export function mouseClick(button?: string, double?: boolean): void;
  export function click(button?: string, double?: boolean): void;
  export function keyTap(key: string, modifiers?: string[]): void;
  export function keyToggle(key: string, down?: boolean, modifiers?: string[]): void;
  export function typeString(str: string): void;
  export function hotkey(...keys: string[]): void;
  export function getMouse(): Point;
  export function getMousePos(): Point;
  export function mouseToggle(down?: boolean, button?: string): void;
  export function scroll(x?: number, y?: number): void;
  export function screenSize(): Size;
  export function getScreenSize(): Size;
  export function getPixelColor(x: number, y: number): string;
  export function getPixels(x: number, y: number, width: number, height: number): Buffer;
}
