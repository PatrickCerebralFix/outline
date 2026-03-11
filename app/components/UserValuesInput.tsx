import debounce from "lodash/debounce";
import { CloseIcon, PlusIcon } from "outline-icons";
import { observer } from "mobx-react";
import { transparentize } from "polished";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Avatar, AvatarSize } from "~/components/Avatar";
import Input from "~/components/Input";
import NudeButton from "~/components/NudeButton";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import { queriedUsers } from "~/stores/UsersStore";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/primitives/Popover";

type Props = {
  selectedIds: string[];
  readOnly?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  onChange: (nextIds: string[]) => void;
};

const fetchQueryOptions = { sort: "name", direction: "ASC" } as const;

export const UserValuesInput = observer(function UserValuesInput({
  selectedIds,
  readOnly,
  placeholder,
  emptyLabel = "—",
  onChange,
}: Props) {
  const { t } = useTranslation();
  const { users } = useStores();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const loadUsersRef = useRef(
    debounce((nextQuery: string) => {
      void users.fetchPage({
        ...fetchQueryOptions,
        limit: 20,
        ...(nextQuery ? { query: nextQuery } : {}),
      });
    }, 200)
  );

  useEffect(() => {
    const missingUserIds = selectedIds.filter((userId) => !users.get(userId));

    if (missingUserIds.length === 0) {
      return;
    }

    void users.fetchPage({
      ids: missingUserIds,
      limit: missingUserIds.length,
      ...fetchQueryOptions,
    });
  }, [selectedIds, users]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    loadUsersRef.current(query);
  }, [open, query]);

  useEffect(
    () => () => {
      loadUsersRef.current.cancel();
    },
    []
  );

  const selectedUsers = useMemo(
    () =>
      selectedIds.reduce<typeof users.orderedData>((result, userId) => {
        const user = users.get(userId);

        if (user) {
          result.push(user);
        }

        return result;
      }, []),
    [selectedIds, users]
  );

  const availableUsers = useMemo(
    () =>
      queriedUsers(users.activeOrInvited, query)
        .filter((user) => !selectedIds.includes(user.id))
        .slice(0, 20),
    [query, selectedIds, users.activeOrInvited]
  );

  const handleRemove = useCallback(
    (userId: string) => {
      onChange(selectedIds.filter((currentId) => currentId !== userId));
    },
    [onChange, selectedIds]
  );

  const handleAdd = useCallback(
    (userId: string) => {
      onChange([...selectedIds, userId]);
      setQuery("");
    },
    [onChange, selectedIds]
  );

  const handleQueryChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  }, []);

  return (
    <Wrapper>
      {selectedUsers.length === 0 &&
        (readOnly ? (
          <EmptyValue>{emptyLabel}</EmptyValue>
        ) : (
          <PlaceholderText>{placeholder ?? t("Select users")}</PlaceholderText>
        ))}
      {selectedUsers.map((user) => (
        <Chip key={user.id}>
          <Avatar model={user} size={AvatarSize.Small} />
          <span>{user.name}</span>
          {!readOnly && (
            <ChipRemove
              onClick={() => handleRemove(user.id)}
              size={16}
              aria-label={t("Remove")}
            >
              <CloseIcon size={12} />
            </ChipRemove>
          )}
        </Chip>
      ))}
      {!readOnly && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger>
            <AddButton size={22} aria-label={t("Add user")}>
              <PlusIcon size={14} />
            </AddButton>
          </PopoverTrigger>
          <PopoverContent width={280} align="start" shrink>
            <SearchInput
              label={t("Search users")}
              labelHidden
              placeholder={t("Search users")}
              value={query}
              onChange={handleQueryChange}
              margin={0}
              autoFocus
            />
            {availableUsers.length === 0 ? (
              <PickerEmpty>
                <Text type="secondary" size="small">
                  {query ? t("No matching users") : t("No more users")}
                </Text>
              </PickerEmpty>
            ) : (
              <UserList>
                {availableUsers.map((user) => (
                  <PickerItem
                    key={user.id}
                    type="button"
                    onClick={() => handleAdd(user.id)}
                  >
                    <Avatar model={user} size={AvatarSize.Small} />
                    <UserText>
                      <span>{user.name}</span>
                      {user.email && <small>{user.email}</small>}
                    </UserText>
                  </PickerItem>
                ))}
              </UserList>
            )}
          </PopoverContent>
        </Popover>
      )}
    </Wrapper>
  );
});

const Wrapper = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 32px;
`;

const PlaceholderText = styled(Text).attrs({
  type: "secondary",
  size: "small",
})``;

const EmptyValue = styled.span`
  color: ${(props) => props.theme.textTertiary};
`;

const Chip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 10px 4px 6px;
  background: ${(props) => transparentize(0.88, props.theme.accent)};
  color: ${(props) => props.theme.text};
  font-size: 14px;
`;

const ChipRemove = styled(NudeButton)`
  color: ${(props) => props.theme.textSecondary};
`;

const AddButton = styled(NudeButton)`
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${(props) => props.theme.textSecondary};
  background: ${(props) => props.theme.backgroundSecondary};
`;

const SearchInput = styled(Input)`
  margin-bottom: 8px;

  input {
    height: 36px;
  }
`;

const PickerEmpty = styled.div`
  padding: 8px 4px 4px;
`;

const UserList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const PickerItem = styled.button`
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: ${(props) => props.theme.menuItemSelected};
  }
`;

const UserText = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;

  span,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: ${(props) => props.theme.textTertiary};
  }
`;
