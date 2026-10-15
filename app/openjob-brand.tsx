/* Brand geometry is generated from docs/brand/assets; keep runtime marks shared. */
type BrandProps = {
  appearance?: "auto" | "dark" | "light";
  className?: string;
};

export function OpenJobBrand({ appearance = "auto", className }: BrandProps) {
  return (
    <span className={className}>
      <picture>
        {appearance === "auto" ? (
          <source media="(prefers-color-scheme: dark)" srcSet="/brand/openjob-lockup-inverse.svg" />
        ) : null}
        {/* SVG lettering is outlined; the accessible name remains OpenJob. */}
        <img
          alt="OpenJob"
          height={36}
          src={`/brand/openjob-lockup${appearance === "dark" ? "-inverse" : ""}.svg`}
          width={160}
        />
      </picture>
    </span>
  );
}

export function OpenJobMark({ className }: { className?: string }) {
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet="/brand/openjob-brandmark-inverse.svg" />
      <img alt="" className={className} height={68} src="/brand/openjob-brandmark.svg" width={68} />
    </picture>
  );
}
