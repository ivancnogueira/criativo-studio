import React from "react";
import type { ProvidersCatalogViewProps } from "./providers-catalog-helpers";
import { useProvidersCatalogController } from "./useProvidersCatalogController";
import { ProviderDetailAccountsSection } from "./ProviderDetailAccountsSection";
import { ProviderDetailConfigSection } from "./ProviderDetailConfigSection";
import { ProvidersMasterView } from "./ProvidersMasterView";

export * from "./providers-catalog-helpers";

export const ProvidersCatalogView: React.FC<ProvidersCatalogViewProps> = (props) => {
  const ctrl = useProvidersCatalogController(props);

  if (ctrl.detailProvider) {
    return (
      <div className="max-w-[780px] mx-auto space-y-6">
        <ProviderDetailAccountsSection ctrl={ctrl} />
        <ProviderDetailConfigSection ctrl={ctrl} />
      </div>
    );
  }

  return <ProvidersMasterView ctrl={ctrl} />;
};
