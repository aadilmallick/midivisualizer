import { pianoConstants } from "../../utils/layout";

const { FIRST_NOTE, LAST_NOTE } = pianoConstants;

const hexToRgba = (hex: string, alpha = 1) => {
  let c = hex.replace("#", "");
  if (c.length === 3)
    c = c
      .split("")
      .map((x) => x + x)
      .join("");
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getSparkColors = (baseHex: string) => [
  baseHex,
  hexToRgba(baseHex, 0.8),
  "#FFFFFF",
  hexToRgba(baseHex, 0.9),
];

const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

const formatTime = (seconds: number) => {
  if (Number.isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};

const getLayout = (width: number): KeyboardLayout => {
  const totalWhiteKeys = 52;
  const whiteKeyWidth = width / totalWhiteKeys;
  const blackKeyWidth = whiteKeyWidth * 0.62;
  const positions: Partial<Record<number, KeyPosition>> = {};
  let whiteIndex = 0;

  for (let midi = FIRST_NOTE; midi <= LAST_NOTE; midi++) {
    if (!isBlackKey(midi)) {
      positions[midi] = {
        x: whiteIndex * whiteKeyWidth,
        width: whiteKeyWidth,
        isBlack: false,
      };
      whiteIndex++;
    }
  }

  for (let midi = FIRST_NOTE; midi <= LAST_NOTE; midi++) {
    if (isBlackKey(midi)) {
      const prevWhiteX = positions[midi - 1]?.x ?? 0;
      positions[midi] = {
        x: prevWhiteX + whiteKeyWidth * 0.68,
        width: blackKeyWidth,
        isBlack: true,
      };
    }
  }

  return { positions, whiteKeyWidth, blackKeyWidth };
};

export { formatTime, getLayout, getSparkColors, isBlackKey, hexToRgba };
