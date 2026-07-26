import { AlertCircle } from "lucide-react";

interface ErrorMessageBannerProps {
  message: string;
  onDismiss: () => void;
}

export const ErrorMessageBanner = ({
  message,
  onDismiss,
}: ErrorMessageBannerProps) => {
  if (!message) return null;

  return (
    <div className="bg-red-600/90 text-white px-6 py-2.5 flex items-center justify-between text-xs font-semibold z-30 shadow-md">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        <span>{message}</span>
      </div>
      <button onClick={onDismiss} className="underline hover:text-slate-200">
        Dismiss
      </button>
    </div>
  );
};
