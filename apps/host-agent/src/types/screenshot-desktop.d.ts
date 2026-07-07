declare module "screenshot-desktop" {
  type Format = "png" | "jpg";

  type ScreenshotOptions = {
    format?: Format;
    filename?: string;
    screen?: number;
  };

  type ScreenshotDesktop = {
    (options?: ScreenshotOptions): Promise<Buffer>;
    all(options?: ScreenshotOptions): Promise<Buffer[]>;
    listDisplays(): Promise<Array<{ id: number; name: string }>>;
  };

  const screenshotDesktop: ScreenshotDesktop;
  export default screenshotDesktop;
}
