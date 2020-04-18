import '@testing-library/jest-dom/extend-expect'

import { render, fireEvent } from '@testing-library/svelte'

import App from './App.svelte'

test('showas everything correctly when rendered', () => {
    const { getByText } = render(App)

    expect(getByText('Hello ')).toBeInTheDocument()
})

// Note: This is as an async test as we are using `fireEvent`
test('goes into room onclick', async () => {
    const { getByText } = render(App)
    let button = getByText('JOIN');

    // Using await when firing events is unique to the svelte testing library because
    // we have to wait for the next `tick` so that Svelte flushes all pending state changes.
    await fireEvent.click(button)

    expect(button).toHaveTextContent('Button Clicked')
})