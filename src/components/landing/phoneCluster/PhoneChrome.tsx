export const PhoneFrame = ({
  width,
  rotate,
  children,
  className = "",
}: {
  width: number;
  rotate?: number;
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`relative rounded-[2rem] p-1 ${className}`}
    style={{
      width: `${width}px`,
      aspectRatio: "9 / 19",
      transform: rotate ? `rotate(${rotate}deg)` : undefined,
      background:
        "linear-gradient(180deg, hsl(var(--olivewood)) 0%, hsl(var(--bark)) 100%)",
      boxShadow:
        "0 0 0 1px hsla(0,0%,100%,0.3), 0 30px 60px -15px rgba(46,47,34,0.3), 0 60px 120px -30px rgba(46,47,34,0.22)",
    }}
  >
    <div
      className="w-full h-full rounded-[1.6rem] overflow-hidden flex flex-col relative"
      style={{ backgroundColor: "hsl(var(--parchment))" }}
    >
      {/* App-internal mesh wash */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(at 80% 10%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 50%), radial-gradient(at 30% 90%, hsl(var(--sage) / 0.1) 0%, transparent 60%)",
        }}
      />
      {children}
    </div>
  </div>
);

export const StatusBar = ({ scale = 1 }: { scale?: number }) => (
  <div
    className="relative flex items-center justify-between"
    style={{
      paddingLeft: `${1.1 * scale}rem`,
      paddingRight: `${1.1 * scale}rem`,
      paddingTop: `${0.5 * scale}rem`,
      paddingBottom: `${0.2 * scale}rem`,
    }}
  >
    <span
      className="font-mono font-semibold"
      style={{ fontSize: `${0.55 * scale}rem`, color: "hsl(var(--ink-deep))" }}
    >
      9:41
    </span>
    <div
      className="rounded-full"
      style={{
        width: `${52 * scale}px`,
        height: `${14 * scale}px`,
        backgroundColor: "hsl(var(--olivewood))",
      }}
    />
    <span
      style={{ fontSize: `${0.5 * scale}rem`, color: "hsl(var(--ink-deep))" }}
    >
      ●●●
    </span>
  </div>
);

export const HomeIndicator = ({ scale = 1 }: { scale?: number }) => (
  <div
    className="mx-auto rounded-full"
    style={{
      width: `${52 * scale}px`,
      height: `${3 * scale}px`,
      backgroundColor: "hsl(var(--olivewood))",
      opacity: 0.4,
      marginTop: `${0.4 * scale}rem`,
      marginBottom: `${0.3 * scale}rem`,
    }}
  />
);
