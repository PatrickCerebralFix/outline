import { runInAction } from "mobx";
import { observer } from "mobx-react";
import { useCallback } from "react";
import { toast } from "sonner";
import useStores from "~/hooks/useStores";
import history from "~/utils/history";
import type { FormData } from "./CollectionForm";
import { CollectionForm } from "./CollectionForm";

type Props = {
  onSubmit: () => void;
  /** Parent collection ID when creating a sub-collection */
  parentCollectionId?: string;
};

export const CollectionNew = observer(function CollectionNew_({
  onSubmit,
  parentCollectionId,
}: Props) {
  const { collections } = useStores();
  const handleSubmit = useCallback(
    async (data: FormData) => {
      try {
        const collection = await collections.save({
          ...data,
          parentCollectionId,
        });
        // Avoid flash of loading state for the new collection, we know it's empty.
        runInAction(() => {
          collection.documents = [];
        });
        onSubmit?.();
        history.push(collection.path);
      } catch (error) {
        toast.error(error.message);
      }
    },
    [collections, onSubmit, parentCollectionId]
  );

  return <CollectionForm handleSubmit={handleSubmit} />;
});
