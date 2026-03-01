"use client";

type SearchInputProps = {
  defaultValue?: string;
};

export default function SearchInput({ defaultValue }: SearchInputProps) {
  return (
    <form action="/search" method="get" className="w-full">
      <input
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="Search posts & bounties..."
        aria-label="Search posts and bounties"
        className="w-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-hover)] focus:outline-none"
      />
    </form>
  );
}
