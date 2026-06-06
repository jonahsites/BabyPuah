import React, { useEffect, useRef, useState } from "react";

interface PayPalButtonProps {
  onSuccess?: (details: any) => void;
  onError?: (err: any) => void;
}

export const PayPalButton: React.FC<PayPalButtonProps> = ({ onSuccess, onError }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let checkAttempts = 0;

    const renderButton = () => {
      if (!active) return;
      
      // @ts-ignore
      if (window.paypal && window.paypal.HostedButtons) {
        setLoading(false);
        try {
          // Clear container first to prevent double rendering
          if (containerRef.current) {
            containerRef.current.innerHTML = "";
          }

          // @ts-ignore
          window.paypal.HostedButtons({
            hostedButtonId: "47F5ZGZM4R5SC",
          }).render("#paypal-container-47F5ZGZM4R5SC");

          console.log("[PayPalButton] Rendered HostedButtons successfully.");
        } catch (err: any) {
          console.error("Error rendering HostedButtons:", err);
          setErrorStatus(err.message || "Failed to render buttons");
          if (onError) onError(err);
        }
      } else {
        // Ensure PayPal script is injected in the document head
        const existingScript = document.querySelector('script[src*="paypal.com/sdk/js"]');
        if (!existingScript) {
          console.log("[PayPalButton] Dynamic script injection for PayPal SDK initiated.");
          const script = document.createElement("script");
          script.src = "https://www.paypal.com/sdk/js?client-id=BAAy62JUVAKrlcAupvGem00sQLMod0nsVAZ8duRWPou_t6h2RKUQfj0o3IaNryLSWpmtm8Mc8jlMIHD2xA&components=hosted-buttons&enable-funding=venmo&currency=USD";
          script.async = true;
          document.head.appendChild(script);
        }

        checkAttempts++;
        if (checkAttempts < 60) {
          setTimeout(renderButton, 350);
        } else {
          setLoading(false);
          setErrorStatus(
            "PayPal SDK failed to load. If you are using Brave, an Ad-Blocker, or a strict browser privacy setting, please turn off shields/trackers for this site or open it in a standard browser window so secure PayPal scripts can connect."
          );
        }
      }
    };

    renderButton();

    return () => {
      active = false;
      // Cleanup container contents on unmount
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [onError, onSuccess]);

  return (
    <div className="w-full flex flex-col items-center">
      {loading && (
        <div className="flex flex-col items-center justify-center py-6 gap-2 text-stone-600 font-bold text-xs uppercase tracking-wider animate-pulse font-mono">
          <span>🌀 Loading Secure Checkout...</span>
        </div>
      )}
      {errorStatus && (
        <div className="text-red-950 text-xs font-mono font-bold text-center border-2 border-red-550 bg-red-50 rounded-xl p-4 max-w-sm mb-4 leading-relaxed">
          ⚠️ <span className="uppercase text-red-650 block mb-1">SDK Load Failure</span>
          {errorStatus}
        </div>
      )}
      <div 
        id="paypal-container-47F5ZGZM4R5SC" 
        ref={containerRef} 
        className="w-full max-w-sm overflow-hidden rounded-xl p-2 bg-white"
      />
    </div>
  );
};

