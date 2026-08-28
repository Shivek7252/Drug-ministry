import { render, screen } from '@testing-library/react';
import AuthGuard from './components/auth/AuthGuard';

jest.mock('./context/AppContext', () => ({
  useApp: () => ({ isLoggedIn: false, setLoginOpen: jest.fn() }),
}));

test('renders the CDSCO portal login experience for a signed-out user', () => {
  render(<AuthGuard><div>Protected reviewer content</div></AuthGuard>);
  expect(screen.getByText(/Export NOC Management System/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Login to Portal/i })).toBeInTheDocument();
  expect(screen.queryByText('Protected reviewer content')).not.toBeInTheDocument();
});
