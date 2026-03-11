import { observer } from "mobx-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import useStores from "~/hooks/useStores";
import type { FormData } from "./CollectionForm";
import { CollectionForm } from "./CollectionForm";
import {
  CollectionPropertyDefinitions,
  type CollectionPropertyDefinitionsHandle,
} from "./CollectionPropertyDefinitions";

type Props = {
  collectionId: string;
  onSubmit: () => void;
};

export const CollectionEdit = observer(function CollectionEdit_({
  collectionId,
  onSubmit,
}: Props) {
  const { collections } = useStores();
  const collection = collections.get(collectionId);
  const propertyDefinitionsRef =
    useRef<CollectionPropertyDefinitionsHandle>(null);
  const [hasPropertyChanges, setHasPropertyChanges] = useState(false);

  const handleSubmit = useCallback(
    async (data: FormData) => {
      try {
        await collection?.save(data);
        const propertySaveSucceeded =
          (await propertyDefinitionsRef.current?.submitChanges()) ?? true;

        if (!propertySaveSucceeded) {
          return;
        }

        onSubmit?.();
      } catch (error) {
        toast.error(error.message);
      }
    },
    [collection, onSubmit]
  );

  return (
    <CollectionForm
      collection={collection}
      handleSubmit={handleSubmit}
      hasExternalChanges={hasPropertyChanges}
      externalChangesLabel="Unsaved property changes"
      afterFields={
        <CollectionPropertyDefinitions
          ref={propertyDefinitionsRef}
          collectionId={collectionId}
          showManageDefinitionsLink={false}
          saveMode="deferred"
          onDirtyChange={setHasPropertyChanges}
        />
      }
    />
  );
});
