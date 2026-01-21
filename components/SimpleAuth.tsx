'use client';

import { useState, useEffect } from 'react';

interface SimpleAuthProps {
  children: React.ReactNode;
  initialPassword?: string; // 默认密码
}

export default function SimpleAuth({ children, initialPassword = 'DHDATool@2026' }: SimpleAuthProps) {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState('');
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // 检查本地存储的认证状态
  useEffect(() => {
    const auth = localStorage.getItem('simpleAuth');
    const storedPassword = localStorage.getItem('authPassword');

    // 如果存储了密码且有认证状态，使用存储的密码
    if (storedPassword) {
      if (auth === 'true') {
        setIsAuthenticated(true);
      }
    } else {
      // 第一次使用，保存初始密码
      localStorage.setItem('authPassword', initialPassword);
    }
  }, [initialPassword]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const storedPassword = localStorage.getItem('authPassword');

    if (password === storedPassword) {
      setIsAuthenticated(true);
      localStorage.setItem('simpleAuth', 'true');
      setError('');
    } else {
      setError('密码错误，请重试');
    }
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 4) {
      setError('密码至少4位');
      return;
    }

    localStorage.setItem('authPassword', newPassword);
    setIsConfiguring(false);
    setError('密码已修改');
    setPassword('');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('simpleAuth');
    setPassword('');
  };

  // 未登录状态显示登录页
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">数据分析应用</h1>
            <p className="text-gray-600 mt-2">请输入访问密码</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                访问密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>

            {error && (
              <div className={`p-3 rounded-lg text-sm ${error.includes('错误') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              进入应用
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setIsConfiguring(!isConfiguring)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                {isConfiguring ? '取消修改密码' : '修改初始密码'}
              </button>
            </div>
          </form>

          {isConfiguring && (
            <div className="mt-6 pt-6 border-t">
              <h3 className="text-sm font-medium text-gray-700 mb-3">修改访问密码</h3>
              <form onSubmit={handlePasswordChange} className="space-y-3">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="新密码（至少4位）"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
                <button
                  type="submit"
                  className="w-full bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 text-sm"
                >
                  确认修改
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 已登录状态显示应用内容
  return (
    <div>
      {/* 顶部导航栏显示登录信息和退出按钮 */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <span className="text-sm text-gray-700">已认证访问</span>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-red-600 transition-colors"
        >
          退出登录
        </button>
      </div>

      {/* 应用内容 */}
      {children}
    </div>
  );
}
