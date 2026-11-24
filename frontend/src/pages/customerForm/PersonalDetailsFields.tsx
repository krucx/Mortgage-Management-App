/** The Customer's name and address. */
export function PersonalDetailsFields({
  name,
  address,
  onChange,
}: {
  name: string
  address: string
  onChange: (field: 'name' | 'address', value: string) => void
}) {
  return (
    <>
      <label>
        Name
        <input required value={name} onChange={(event) => onChange('name', event.target.value)} />
      </label>
      <label>
        Address
        <textarea
          rows={2}
          value={address}
          onChange={(event) => onChange('address', event.target.value)}
        />
      </label>
    </>
  )
}
