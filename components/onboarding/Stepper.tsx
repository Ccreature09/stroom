interface StepperProps {
  steps: readonly string[];
  currentStep: number;
}

export default function Stepper({ steps, currentStep }: StepperProps) {
  return (
    <ol className="flex items-center">
      {steps.map((label, index) => {
        const isComplete = index < currentStep;
        const isCurrent = index === currentStep;

        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-2">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  isComplete
                    ? "bg-indigo-600 text-white"
                    : isCurrent
                      ? "border-2 border-indigo-600 text-indigo-600 dark:text-indigo-400"
                      : "border-2 border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-600"
                }`}
              >
                {isComplete ? "✓" : index + 1}
              </span>
              <span
                className={`whitespace-nowrap text-xs font-medium ${
                  isCurrent
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`mx-3 h-0.5 flex-1 rounded transition-colors ${
                  isComplete ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-800"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
