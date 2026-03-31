import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createNetworkConfig, IotaClientProvider, WalletProvider } from "@iota/dapp-kit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@iota/dapp-kit/dist/index.css";
import App from "./App";
import "./styles.css";

const walletRpcUrl = import.meta.env.VITE_IOTA_RPC_URL?.trim() || "https://api.devnet.iota.cafe";

const { networkConfig } = createNetworkConfig({
  devnet: { url: walletRpcUrl },
});

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IotaClientProvider networks={networkConfig} defaultNetwork="devnet">
        <WalletProvider>
          <App />
        </WalletProvider>
      </IotaClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
