const paths = {
  plus: "M12 5v14M5 12h14",
  send: "m5 12 14-7-7 14-2-7-5 0Zm5 0 9-7",
  book: "M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3V4Z",
  archive: "M4 8h16v12H4V8ZM3 4h18v4H3V4Zm7 8h4",
  trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  edit: "m15 4 5 5-11 11-6 1 1-6L15 4Zm-2 2 5 5",
  logout: "M9 4H4v16h5m6-13 5 5-5 5m-7-5h12",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  arrow: "m14 5-7 7 7 7",
  chat: "M21 11a8 8 0 0 1-8 8H8l-5 3 1-6a8 8 0 0 1-1-5 9 9 0 0 1 18 0Z",
  leaf: "M20 3C8 2 2 7 5 15s16 6 15-12ZM4 21 16 8",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
};
export default function Icon({
  name,
  size = 20,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
