// Scripted versions of the demo shop's .kane journeys, for the offline end-to-end test only.
export default {
  browse: {
    steps: [
      { heading: 'Search the shop', run: async (p, t) => { await p.getByPlaceholder('Search products').fill('kettle', t); await p.getByText('Copper Kettle').first().waitFor(t); }, why: 'The product list never loaded' },
      { heading: 'Add it to the cart', run: async (p, t) => { await p.getByRole('button', { name: 'Add to cart' }).first().click(t); await p.getByLabel('1 items in cart').waitFor(t); } },
    ],
  },
  checkout: {
    steps: [
      { heading: 'Add a product', run: async (p, t) => p.getByRole('button', { name: 'Add to cart' }).first().click(t), why: 'There is no "Add to cart" button: the shop did not render', bug: 'Shop page renders blank' },
      { heading: 'Open the cart', run: async (p, t) => { await p.getByRole('link', { name: /Cart/ }).click(t); await p.getByText('Your cart').waitFor(t); } },
      { heading: 'Go to checkout', run: async (p, t) => p.getByRole('button', { name: 'Go to checkout' }).click(t) },
      { heading: 'Fill in the delivery details', run: async (p) => { await p.getByLabel('Full name').fill('Ada Lovelace'); await p.getByLabel('Email').fill('ada@example.com'); await p.getByLabel('Street address').fill('12 Analytical Row'); await p.getByLabel('Postcode').fill('N1 9GU'); } },
      { heading: 'Place the order', run: async (p, t) => { await p.getByRole('button', { name: /Place order/ }).click(t); await p.getByRole('heading', { name: 'Order confirmed' }).waitFor(t); } },
    ],
  },
  checkout_errors: {
    steps: [
      { heading: 'Add a product and go to checkout', run: async (p, t) => { await p.getByRole('button', { name: 'Add to cart' }).first().click(t); await p.getByRole('link', { name: /Cart/ }).click(t); await p.getByRole('button', { name: 'Go to checkout' }).click(t); }, why: 'There is no "Add to cart" button: the shop did not render', bug: 'Shop page renders blank' },
      { heading: 'Submit with a missing name and a bad email', run: async (p, t) => { await p.getByLabel('Email').fill('not-an-email'); await p.getByRole('button', { name: /Place order/ }).click(t); } },
      { heading: 'See the errors', run: async (p, t) => { await p.getByText('Please enter your name').waitFor(t); await p.getByText('Enter a valid email address').waitFor(t); }, why: 'Clicking "Place order" with a bad email shows no error messages', bug: 'Checkout validation errors never appear' },
    ],
  },
};
