import { useState } from 'react';
import { Header } from '../components/Header';

function App() {
  const [todos, setTodos] = useState([
    { id: 1, text: 'Learn about SSG', completed: true },
    { id: 2, text: 'Try SPA routing', completed: false },
    { id: 3, text: 'Build awesome apps', completed: false },
  ]);
  const [newTodo, setNewTodo] = useState('');

  const addTodo = () => {
    if (newTodo.trim()) {
      setTodos([
        ...todos,
        {
          id: Date.now(),
          text: newTodo.trim(),
          completed: false,
        },
      ]);
      setNewTodo('');
    }
  };

  const toggleTodo = (id: number) => {
    setTodos(
      todos.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo,
      ),
    );
  };

  const deleteTodo = (id: number) => {
    setTodos(todos.filter((todo) => todo.id !== id));
  };

  return (
    <div>
      <Header />

      <main className="main-content">
        <h1 className="hero-title">Interactive App</h1>
        <p className="hero-subtitle">
          Another SPA route with interactive functionality - perfect for user
          applications
        </p>

        <div className="card">
          <h2>Todo Manager</h2>

          <div style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <input
                type="text"
                value={newTodo}
                onChange={(e) => setNewTodo(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addTodo()}
                placeholder="Add a new todo..."
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'inherit',
                  fontSize: '1rem',
                }}
              />
              <button
                onClick={addTodo}
                style={{
                  padding: '0.75rem 1.5rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#4CAF50',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '500',
                }}
              >
                Add
              </button>
            </div>
          </div>

          <div style={{ textAlign: 'left' }}>
            {todos.length === 0 ? (
              <p
                style={{
                  textAlign: 'center',
                  color: 'rgba(255, 255, 255, 0.7)',
                }}
              >
                No todos yet. Add one above!
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {todos.map((todo) => (
                  <li
                    key={todo.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      padding: '1rem',
                      marginBottom: '0.5rem',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={todo.completed}
                      onChange={() => toggleTodo(todo.id)}
                      style={{ transform: 'scale(1.2)' }}
                    />
                    <span
                      style={{
                        flex: 1,
                        textDecoration: todo.completed
                          ? 'line-through'
                          : 'none',
                        opacity: todo.completed ? 0.7 : 1,
                      }}
                    >
                      {todo.text}
                    </span>
                    <button
                      onClick={() => deleteTodo(todo.id)}
                      style={{
                        padding: '0.5rem',
                        borderRadius: '4px',
                        border: 'none',
                        background: '#f44336',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div
            style={{
              marginTop: '2rem',
              padding: '1rem',
              background: 'rgba(33, 150, 243, 0.2)',
              borderRadius: '8px',
              borderLeft: '4px solid #2196F3',
            }}
          >
            <p>
              <strong>🚀 SPA Features:</strong> This interactive todo app
              demonstrates client-side state management, real-time updates, and
              user interactions - perfect for dynamic applications that need
              immediate responsiveness.
            </p>
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-content">
          <p>&copy; 2024 Unirend Demo - Interactive App (SPA)</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
