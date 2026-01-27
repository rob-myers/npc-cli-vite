import { cn } from "../service/tailwind-cn";

/**
 * Centered loading spinner.
 */
export const Spinner = ({ className = "size-4" }: { className?: string }) => {
  return (
    <div className="flex h-full justify-center items-center">
      <div
        className={cn(
          "border-3 rounded-full border-spinner border-b-transparent animate-spin",
          className,
        )}
      />
    </div>
  );
};
